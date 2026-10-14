import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { check, type Context } from '../contracts.ts';
import type { EngineModule, ModuleHost } from './types.ts';
import { UpdateService } from '../native/update-service.ts';
import { DataGuard } from '../native/update-data-guard.ts';
import { BackgroundService } from '../native/background-service.ts';
import { keychainStatus } from '../native/keychain-status.ts';
import { BundledPostgres } from '../native/postgres-lifecycle.ts';

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
const options = (host: ModuleHost) => host.options as ReleaseOptions;
const updates = new Map<string, UpdateService>();

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
  const o = options(host);
  check(typeof o.releasePublicKey === 'string' && o.releasePublicKey.length > 0, 'UPDATES_UNAVAILABLE', 'Configure a publisher-pinned release key in the engine.');
  const installRoot = o.installRoot ?? join(host.directory, 'install');
  const key = `${host.directory}\u0000${installRoot}`;
  let service = updates.get(key);
  if (!service) {
    service = new UpdateService({ publicKey: o.releasePublicKey, version: await engineVersion(host), channel: o.channel ?? 'preview', installRoot,
      appDataDirectory: host.directory, feedUrl: o.feedUrl, http: o.http, unpack: o.unpack, installId: await installId(host.directory), demo: host.demo,
      dataSchemaVersion: o.dataSchemaVersion, previewExpiresAt: o.previewExpiresAt ?? null, builtAt: o.builtAt ?? null });
    updates.set(key, service);
  }
  return service;
}
function backgroundService(host: ModuleHost): BackgroundService {
  const o = options(host);
  check(typeof o.appExecutable === 'string' && isAbsolute(o.appExecutable), 'SERVICE_UNAVAILABLE', 'Background mode needs the installed desktop app.');
  return new BackgroundService({ executable: o.appExecutable, dataDirectory: host.directory, platform: o.platform, homeDirectory: o.homeDirectory, uid: o.uid, runner: o.serviceRunner });
}
function bundledPostgres(host: ModuleHost): BundledPostgres {
  const o = options(host);
  check(typeof o.resourcesPath === 'string' && isAbsolute(o.resourcesPath), 'DATABASE_RUNTIME_UNAVAILABLE', 'The bundled database runtime is only present in the installed app.');
  return new BundledPostgres({ runtimeRoot: join(o.resourcesPath, 'runtime-binaries'), dataRoot: join(host.directory, 'postgres'), platform: o.platform, ...(o.postgres ?? {}) } as any);
}
/** A vault copy taken immediately before a data-schema change, hashed for the swap's evidence. */
async function vaultCopy(host: ModuleHost) {
  const backup = await host.call('workspace.backup', {}) as { path?: unknown };
  check(typeof backup.path === 'string', 'BACKUP_REQUIRED', 'A vault copy could not be made before the update.');
  return { path: backup.path, sha256: createHash('sha256').update(await readFile(backup.path)).digest('hex') };
}

export const releaseModule: EngineModule = {
  id: 'release',
  methods: {
    'release.status': { permission: 'read', async handler(_ctx, _payload, host) {
      const o = options(host), version = await engineVersion(host);
      if (!o.releasePublicKey) {
        const data = await new DataGuard({ appDataDirectory: host.directory }).marker();
        return { version, channel: o.channel ?? 'preview', configured: false, demo: host.demo, dataSchema: data };
      }
      return { configured: true, ...await (await updateService(host)).status() };
    } },
    'release.checkUpdate': { permission: 'admin', external: true, async handler(ctx, _payload, host) {
      writer(ctx); return (await updateService(host)).check();
    } },
    'release.stageUpdate': { permission: 'admin', external: true, async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await updateService(host)).stage();
    } },
    'release.applyUpdate': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload);
      const service = await updateService(host), status = await service.status();
      // Always-waits: the person confirmed; a schema change additionally needs a fresh vault copy.
      const backup = status.candidate && status.candidate.dataSchemaVersion > (options(host).dataSchemaVersion ?? 1) ? await vaultCopy(host) : null;
      return service.apply({ confirmed: true, backup });
    } },
    'release.rollback': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return (await updateService(host)).rollback({ confirmed: true });
    } },
    'release.confirmHealthy': { permission: 'admin', async handler(ctx, _payload, host) {
      writer(ctx); return (await updateService(host)).confirmHealthy();
    } },
    'native.keychainStatus': { permission: 'admin', async handler(_ctx, _payload, host) {
      const o = options(host);
      return keychainStatus({ platform: o.platform ?? process.platform, arch: o.arch ?? process.arch, environment: o.environment ?? process.env,
        resourcesPath: o.resourcesPath ?? '', demo: host.demo });
    } },
    'native.databaseStatus': { permission: 'admin', async handler(_ctx, _payload, host) {
      return bundledPostgres(host).status();
    } },
    'service.status': { permission: 'admin', async handler(_ctx, _payload, host) { return backgroundService(host).status(); } },
    'service.plan': { permission: 'admin', async handler(_ctx, _payload, host) { return backgroundService(host).plan(); } },
    'service.install': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return backgroundService(host).install({ confirmed: true });
    } },
    'service.uninstall': { permission: 'admin', async handler(ctx, payload, host) {
      writer(ctx); confirmed(payload); return backgroundService(host).uninstall({ confirmed: true });
    } },
  },
};
