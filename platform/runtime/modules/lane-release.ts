import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { check, type Context } from '../contracts.ts';
import type { EngineModule, ModuleHost } from './types.ts';
import { UpdateService } from '../native/update-service.ts';
import { DataGuard } from '../native/update-data-guard.ts';
import { BackgroundService } from '../native/background-service.ts';
import { keychainStatus } from '../native/keychain-status.ts';
import { BundledPostgres } from '../native/postgres-lifecycle.ts';
import { releaseModuleOptions } from '../native/release-options.ts';
import { confirmInstalledTrial, type TrialConfirmation } from '../native/update-launch.ts';

/**
 * Release lane: update channel, swap and rollback, the background service, keychain status
 * and the bundled database status. Every option below is trusted host composition
 * (`EngineOptions.modules.release`), never renderer or archive input.
 */
type ReleaseOptions = {
  releasePublicKey?: string; channel?: 'stable' | 'preview'; feedUrl?: string; installRoot?: string;
  previewExpiresAt?: string | null; builtAt?: string | null; dataSchemaVersion?: number;
  platform?: NodeJS.Platform; arch?: string; resourcesPath?: string; appExecutable?: string;
  environment?: NodeJS.ProcessEnv; http?: any; unpack?: any; serviceRunner?: any; homeDirectory?: string; uid?: number;
  postgres?: Record<string, unknown>;
};
const options = async (host: ModuleHost) => host.options as ReleaseOptions;
const updates = new Map<string, UpdateService>();
const channelOf = (o: ReleaseOptions) => o.channel ?? (o.previewExpiresAt ? 'preview' : 'stable');

function writer(ctx: Context) {
  check(ctx.channel === undefined || ctx.channel === 'desktop', 'OPEN_DESKTOP', 'Open the desktop app for this request.');
  check(!ctx.sourceTainted, 'TAINTED_RELEASE_REQUEST', 'Only an explicit app request can change the installed app.');
}
function confirmed(payload: Record<string, any>) {
  check(payload.confirmed === true, 'CONFIRMATION_REQUIRED', 'Review the change and confirm it in the app.');
}
async function engineVersion(host: ModuleHost): Promise<string> {
  const status = await host.call('workspace.status', {}) as { version?: unknown };
  check(typeof status.version === 'string', 'RELEASE_VERSION_UNKNOWN', 'The running app version is unknown.');
  return status.version;
}
/** One stable, random identifier per installation; it decides the staged-rollout bucket only. */
async function installId(directory: string): Promise<string> {
  const path = join(directory, 'release', 'install-id');
  try { const value = (await readFile(path, 'utf8')).trim(); if (/^[A-Za-z0-9_-]{8,128}$/.test(value)) return value; }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  await mkdir(join(directory, 'release'), { recursive: true, mode: 0o700 });
  const value = randomBytes(18).toString('base64url');
  try { await writeFile(path, value, { flag: 'wx', mode: 0o600 }); return value; }
  catch (error: any) { if (error?.code === 'EEXIST') return (await readFile(path, 'utf8')).trim(); throw error; }
}
async function updateService(host: ModuleHost): Promise<UpdateService> {
  const o = await options(host);
  check(typeof o.releasePublicKey === 'string' && o.releasePublicKey.length > 0, 'UPDATES_UNAVAILABLE', 'Configure a publisher-pinned release key in the engine.');
  const installRoot = o.installRoot ?? join(host.directory, 'install');
  const key = `${host.directory}\u0000${installRoot}`;
  let service = updates.get(key);
  if (!service) {
    service = new UpdateService({ publicKey: o.releasePublicKey, version: await engineVersion(host), channel: channelOf(o), installRoot,
      appDataDirectory: host.directory, feedUrl: o.feedUrl, http: o.http, unpack: o.unpack, installId: await installId(host.directory), demo: host.demo,
      dataSchemaVersion: o.dataSchemaVersion, previewExpiresAt: o.previewExpiresAt ?? null, builtAt: o.builtAt ?? null });
    updates.set(key, service);
  }
  return service;
}
async function backgroundService(host: ModuleHost): Promise<BackgroundService> {
  const o = await options(host);
  check(typeof o.appExecutable === 'string' && isAbsolute(o.appExecutable), 'SERVICE_UNAVAILABLE', 'Background mode needs the installed desktop app.');
  return new BackgroundService({ executable: o.appExecutable, dataDirectory: host.directory, platform: o.platform, homeDirectory: o.homeDirectory, uid: o.uid, runner: o.serviceRunner });
}
async function bundledPostgres(host: ModuleHost): Promise<BundledPostgres> {
  const o = await options(host);
  check(typeof o.resourcesPath === 'string' && isAbsolute(o.resourcesPath), 'DATABASE_RUNTIME_UNAVAILABLE', 'The bundled database runtime is only present in the installed app.');
  return new BundledPostgres({ runtimeRoot: join(o.resourcesPath, 'runtime-binaries'), dataRoot: join(dirname(host.directory), 'database'), platform: o.platform, ...(o.postgres ?? {}) } as any);
}
/**
 * Automatic health confirmation. After an update the launcher starts the new version on trial and
 * rolls it back after two launches that never confirmed. Reaching any release method means a
 * workspace is open in this engine, which is the health signal: the first desktop call (the desktop
 * host calls `release.status` once a workspace opens) commits a trial of exactly the running version.
 * Only installs started through the launcher (`installRoot` set) take part; once per process. The
 * confirmation then records the running version's data schema in the marker.
 */
const trials = new Map<string, Promise<TrialConfirmation>>();
async function confirmTrial(ctx: Context, host: ModuleHost, version: string): Promise<TrialConfirmation | 'failed' | null> {
  const o = await options(host);
  if (!o.installRoot || !isAbsolute(o.installRoot) || (ctx.channel !== undefined && ctx.channel !== 'desktop') || ctx.sourceTainted) return null;
  const key = `${o.installRoot}\u0000${version}`;
  let pending = trials.get(key);
  if (!pending) {
    pending = confirmInstalledTrial(o.installRoot, version).then(async result => {
      // The data-schema marker rises only here, after this exact version is confirmed healthy with an open
      // workspace, so the launcher's automatic rollback stays possible until then (update-service.ts).
      if (result === 'confirmed' || result === 'already-committed') {
        const guard = new DataGuard({ appDataDirectory: host.directory }), schema = o.dataSchemaVersion ?? 1, marker = await guard.marker();
        if (!marker || marker.dataSchemaVersion < schema) await guard.recordSchema(schema, version);
      }
      return result;
    });
    trials.set(key, pending); pending.catch(() => trials.delete(key));
  }
  return pending.catch(() => 'failed' as const);
}
/** A vault copy taken immediately before a data-schema change, hashed for the swap's evidence. */
async function vaultCopy(host: ModuleHost) {
  const backup = await host.call('workspace.backup', {}) as { path?: unknown };
  check(typeof backup.path === 'string', 'BACKUP_REQUIRED', 'A vault copy could not be made before the update.');
  return { path: backup.path, sha256: createHash('sha256').update(await readFile(backup.path)).digest('hex') };
}

export const releaseModule: EngineModule = {
  id: 'release',
  // The installed desktop app wires the module from the engine worker's own trusted environment.
  hostOptions: ({ env }) => releaseModuleOptions(env),
  methods: {
    'release.status': { permission: 'read', async handler(ctx, _payload, host) {
      const o = await options(host), version = await engineVersion(host), trial = await confirmTrial(ctx, host, version);
      // An older app never opens data a newer one wrote: the marker check here, and vault.ts refuses a
      // snapshot schema it does not know. `vaultCompatible: false` drives the "update needed" banner.
      const guard = new DataGuard({ appDataDirectory: host.directory });
      const vaultCompatible = await guard.assertAppCanOpen(o.dataSchemaVersion ?? 1).then(() => true, (error: any) => {
        if (error?.code === 'VAULT_NEWER_THAN_APP') return false; throw error; });
      if (!o.releasePublicKey) return { version, channel: channelOf(o), configured: false, demo: host.demo, dataSchema: await guard.marker(), vaultCompatible, trial };
      return { configured: true, vaultCompatible, trial, ...await (await updateService(host)).status() };
    } },
    'release.checkUpdate': { permission: 'admin', external: true, async handler(ctx, _payload, host) {
      writer(ctx); return (await updateService(host)).check();
    } },
    'release.stageUpdate': { permission: 'admin', external: true, async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await updateService(host)).stage();
    } },
    'release.applyUpdate': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload);
      // Always-waits: the person confirmed. A fresh vault copy precedes every swap, so a data-schema
      // change (which the service requires it for) is covered even after a restart lost the candidate.
      const service = await updateService(host);
      return service.apply({ confirmed: true, backup: await vaultCopy(host) });
    } },
    'release.rollback': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await updateService(host)).rollback({ confirmed: true });
    } },
    'release.confirmHealthy': { permission: 'admin', async handler(ctx, _payload, host) {
      writer(ctx); return (await updateService(host)).confirmHealthy();
    } },
    'native.keychainStatus': { permission: 'admin', async handler(_ctx, _payload, host) {
      const o = await options(host);
      return keychainStatus({ platform: o.platform ?? process.platform, arch: o.arch ?? process.arch, environment: o.environment ?? process.env,
        resourcesPath: o.resourcesPath ?? '', demo: host.demo });
    } },
    'native.databaseStatus': { permission: 'admin', async handler(_ctx, _payload, host) {
      return (await bundledPostgres(host)).status();
    } },
    'service.status': { permission: 'admin', async handler(_ctx, _payload, host) { return (await backgroundService(host)).status(); } },
    'service.plan': { permission: 'admin', async handler(_ctx, _payload, host) { return (await backgroundService(host)).plan(); } },
    'service.install': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await backgroundService(host)).install({ confirmed: true });
    } },
    'service.uninstall': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await backgroundService(host)).uninstall({ confirmed: true });
    } },
  },
};
