import { createHash, type KeyObject } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { check, ChausarError } from '../contracts.ts';
import { ReleaseUpdater, canonicalReleaseManifest, type ReleaseManifest } from '../updater.ts';
import type { BoundedHttp } from '../connectors.ts';
import { safeDirectory } from '../vault.ts';
import { ChannelGuard, channelEntry, selectRelease, validInstallId, type AcceptedChannelState, type ChannelName, type ChannelRelease, type ReleaseArchitecture, type ReleasePlatform } from './update-channel.ts';
import { buildExpiry, type BuildExpiry, type BuildUsability } from './update-expiry.ts';
import { InstallLayout, artifactKind, type InstallPointer, type LaunchDecision, type Unpack } from './update-install.ts';
import { DataGuard, VersionSchemaLedger, type BackupEvidence, type DataSchemaMarker } from './update-data-guard.ts';
import { UpdateFeedClient } from './update-feed-client.ts';
import { exactKeys, readJsonFile, writeJsonAtomic } from './update-files.ts';

/** Trusted engine configuration only; never built from renderer or feed input. */
export type UpdateServiceOptions = {
  publicKey:string|KeyObject; version:string; channel:ChannelName; installRoot:string; appDataDirectory:string;
  feedUrl?:string; http?:BoundedHttp; unpack?:Unpack; installId:string; demo:boolean; now?:()=>number;
  /** Data schema the running app reads and writes (default 1). */
  dataSchemaVersion?:number;
  /** Preview builds pass their own expiry (see readBuildMetadata); stable builds omit it. */
  previewExpiresAt?:string|null; builtAt?:string|null;
};
export type InstallMode = 'in-place-swap' | 'manual-native-installer-required';
export type UpdateStatus = Readonly<{
  version:string; channel:ChannelName; demo:boolean; build:BuildUsability; feedConfigured:boolean;
  lastFeed:AcceptedChannelState|null; install:InstallPointer|null; dataSchema:DataSchemaMarker|null;
  candidate:Readonly<{ version:string; dataSchemaVersion:number }>|null;
}>;
export type CheckResult =
  | Readonly<{ action:'none'; reason:'up-to-date'|'not-in-rollout'; currentVersion:string; feedIssuedAt:string }>
  | Readonly<{ action:'update'; currentVersion:string; version:string; feedIssuedAt:string; rolloutPercent:number; previewExpiresAt:string|null;
      manifestSha256:string; dataSchemaVersion:number; size:number; installMode:InstallMode; backupRequired:boolean }>
  | Readonly<{ action:'rollback-advised'; currentVersion:string; to:string|null; feedIssuedAt:string;
      /** True when the install layout already holds the advised version as `previous`. */
      previousInstalled:boolean }>;
export type StageResult = Readonly<{ staged:true; version:string; artifactSha256:string; size:number; dataSchemaVersion:number; installMode:InstallMode; installed:false }>;
export type ApplyResult = Readonly<{ applied:true; version:string; previous:string|null; state:'trial'; restartRequired:true; backupVerified:boolean; fromSchema:number; toSchema:number }>;
export type ServiceRollbackResult = Readonly<{ rolledBack:true; from:string; to:string; restartRequired:true }>;
type Candidate = { text:string; signature:string; manifest:ReleaseManifest; release:ChannelRelease };

/** True when `version` can open the vault the data-schema marker describes (no marker: any version can). */
async function versionCanOpenVault(data:DataGuard, ledger:VersionSchemaLedger, version:string):Promise<boolean> {
  const marker = await data.marker();
  if (!marker) return true;
  const schema = await ledger.schemaOf(version);
  // A version whose schema was never recorded is treated as unable to open a migrated vault.
  return schema !== null && schema >= marker.dataSchemaVersion;
}
const DATA_LINK = 'app-data.json';
/**
 * The launcher's entry (platform/runtime/native/update-launch.ts), before any app runs and without the release key:
 * the same rule as `UpdateService.resolveLaunch`. `apply` leaves `<installRoot>/app-data.json` naming the app data
 * folder, so the automatic rollback can check the data-schema marker. Without that record a trial is never rolled
 * back automatically (it stays current with `rollbackUnavailable`), because the vault's schema cannot be checked.
 */
export async function resolveInstalledLaunch(options:{ installRoot:string; now?:()=>number }):Promise<LaunchDecision|null> {
  check(isAbsolute(options.installRoot), 'UNSAFE_UPDATE_PATH', 'Choose an absolute install directory.');
  const layout = new InstallLayout({ installRoot: options.installRoot, now: options.now });
  const record:any = await readJsonFile(join(options.installRoot, DATA_LINK), 4096, 'INSTALL_DATA_LINK_INVALID');
  check(record === undefined || (exactKeys(record, ['appDataDirectory']) && typeof record.appDataDirectory === 'string' && isAbsolute(record.appDataDirectory) && !/[\x00-\x1f]/.test(record.appDataDirectory)),
    'INSTALL_DATA_LINK_INVALID', 'The install record of the app data folder is invalid.');
  if (record === undefined) return layout.resolveLaunch({ canReturnTo: async () => false });
  const data = new DataGuard({ appDataDirectory: record.appDataDirectory }), ledger = new VersionSchemaLedger({ appDataDirectory: record.appDataDirectory });
  return layout.resolveLaunch({ canReturnTo: version => versionCanOpenVault(data, ledger, version) });
}

export class UpdateService {
  #version:string; #channel:ChannelName; #installId:string; #demo:boolean; #now:()=>number; #schema:number;
  #stageDirectory:string; #updater:ReleaseUpdater; #guard:ChannelGuard; #layout:InstallLayout; #data:DataGuard; #ledger:VersionSchemaLedger; #feed:UpdateFeedClient|null; #expiry:BuildExpiry;
  #candidate:Candidate|null = null; #installRoot:string; #appData:string;
  constructor(options:UpdateServiceOptions) {
    check(isAbsolute(options.installRoot) && isAbsolute(options.appDataDirectory), 'UNSAFE_UPDATE_PATH', 'Choose absolute install and application data directories.');
    check(validInstallId(options.installId), 'INVALID_INSTALL_ID', 'The install identifier must be 8 to 128 URL-safe characters.');
    const schema = options.dataSchemaVersion ?? 1;
    check(Number.isSafeInteger(schema) && schema > 0 && schema <= 1000, 'INVALID_DATA_SCHEMA', 'The data schema version must be a positive integer.');
    this.#version = options.version; this.#channel = options.channel; this.#installId = options.installId; this.#demo = options.demo !== false;
    this.#installRoot = options.installRoot; this.#appData = options.appDataDirectory;
    this.#now = options.now ?? Date.now; this.#schema = schema; this.#stageDirectory = join(options.installRoot, 'staging');
    this.#updater = new ReleaseUpdater({ publicKey: options.publicKey, version: options.version, stageDirectory: this.#stageDirectory, http: options.http });
    this.#guard = new ChannelGuard({ publicKey: options.publicKey, channel: options.channel, stateDirectory: join(options.appDataDirectory, 'release'), now: this.#now });
    this.#layout = new InstallLayout({ installRoot: options.installRoot, unpack: options.unpack, now: this.#now });
    this.#data = new DataGuard({ appDataDirectory: options.appDataDirectory, now: this.#now });
    this.#ledger = new VersionSchemaLedger({ appDataDirectory: options.appDataDirectory });
    this.#feed = options.feedUrl === undefined ? null : new UpdateFeedClient({ feedUrl: options.feedUrl, http: options.http, demo: this.#demo });
    this.#expiry = buildExpiry({ channel: options.channel, builtAt: options.builtAt ?? null, previewExpiresAt: options.previewExpiresAt ?? null });
  }
  /** The layout itself, for the launcher's resolveLaunch() before the engine starts. */
  get layout():InstallLayout { return this.#layout; }
  async status():Promise<UpdateStatus> {
    const candidate = this.#candidate ? Object.freeze({ version: this.#candidate.manifest.version, dataSchemaVersion: this.#candidate.manifest.dataSchemaVersion }) : null;
    return Object.freeze({ version: this.#version, channel: this.#channel, demo: this.#demo, build: this.#expiry.status(this.#now()), feedConfigured: this.#feed !== null,
      lastFeed: await this.#guard.lastAccepted(), install: await this.#layout.pointer(), dataSchema: await this.#data.marker(), candidate });
  }
  async #fromSchema():Promise<number> { return Math.max(this.#schema, (await this.#data.marker())?.dataSchemaVersion ?? 0); }
  /** Feed → verify and accept channel → select (rollout, kill switch) → fetch and verify the bound manifest. */
  async check():Promise<CheckResult> {
    check(!this.#demo, 'DEMO_EXTERNAL_DISABLED', 'Demo mode keeps update checks switched off.');
    check(this.#feed, 'UPDATE_FEED_NOT_CONFIGURED', 'No update feed is configured for this build.');
    const feed = await this.#feed.fetchChannel(), document = await this.#guard.accept(feed.text, feed.signature);
    const selection = selectRelease(document, { platform: process.platform, arch: process.arch, currentVersion: this.#version, installId: this.#installId, now: this.#now() });
    this.#candidate = null;
    if (selection.action === 'none') return Object.freeze({ action: 'none', reason: selection.reason, currentVersion: this.#version, feedIssuedAt: document.issuedAt });
    if (selection.action === 'rollback-advised') {
      const pointer = await this.#layout.pointer();
      return Object.freeze({ action: 'rollback-advised', currentVersion: this.#version, to: selection.to, feedIssuedAt: document.issuedAt, previousInstalled: selection.to !== null && pointer?.version === this.#version && pointer.previous === selection.to });
    }
    const release = selection.release, signed = await this.#feed.fetchManifest(release.version, release.platform as ReleasePlatform, release.architecture as ReleaseArchitecture);
    check(createHash('sha256').update(signed.text).digest('hex') === release.manifestSha256, 'UPDATE_MANIFEST_MISMATCH', 'The release manifest differs from the one named by the signed feed.');
    const manifest = this.#updater.verify(signed.text, signed.signature);
    check(manifest.version === release.version, 'UPDATE_MANIFEST_MISMATCH', 'The release manifest names a different version than the feed.');
    this.#candidate = { text: signed.text, signature: signed.signature, manifest, release };
    return Object.freeze({ action: 'update', currentVersion: this.#version, version: manifest.version, feedIssuedAt: document.issuedAt, rolloutPercent: release.rolloutPercent,
      previewExpiresAt: release.previewExpiresAt, manifestSha256: release.manifestSha256, dataSchemaVersion: manifest.dataSchemaVersion, size: manifest.size,
      installMode: installMode(manifest), backupRequired: manifest.dataSchemaVersion > await this.#fromSchema() });
  }
  /** Downloads and verifies the artifact chosen by the last check(). Nothing is installed or executed. */
  async stage():Promise<StageResult> {
    check(this.#candidate, 'UPDATE_NOT_CHECKED', 'Check for an update before downloading it.');
    await this.#refuseWithdrawn(this.#candidate.manifest, 'UPDATE_WITHDRAWN');
    const staged = await this.#updater.stage(this.#candidate.text, this.#candidate.signature), manifest = staged.manifest;
    return Object.freeze({ staged: true, version: manifest.version, artifactSha256: manifest.sha256, size: manifest.size, dataSchemaVersion: manifest.dataSchemaVersion, installMode: installMode(manifest), installed: false });
  }
  /** Always waits for a person: requires confirmed === true, a verified backup on a schema bump, then swaps atomically. */
  async apply(input:{ confirmed:boolean; backup?:BackupEvidence|null }):Promise<ApplyResult> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Installing an update waits for your confirmation.');
    const { manifest, artifactPath } = await this.#pending();
    check(installMode(manifest) === 'in-place-swap', 'NATIVE_INSTALLER_REQUIRED', 'This release is a native installer. Chausar never runs a downloaded installer; install it yourself.');
    // The newest signed feed this install accepted may have withdrawn the staged release since it was downloaded.
    await this.#refuseWithdrawn(manifest, 'UPDATE_WITHDRAWN');
    const fromSchema = await this.#fromSchema();
    check(fromSchema <= manifest.dataSchemaVersion, 'VAULT_NEWER_THAN_APP', 'This vault was written by a newer Chausar than the staged release.');
    const backup = await this.#data.requireBackupBeforeSchemaChange({ fromSchema, toSchema: manifest.dataSchemaVersion, backup: input.backup ?? null });
    // The marker is raised by the new app when it migrates, not here, so a rollback can still open the vault.
    // Both sides' schemas are recorded before the pointer moves, so every later rollback can be checked against the marker.
    await this.#ledger.record([[this.#version, this.#schema], [manifest.version, manifest.dataSchemaVersion]]);
    // The launcher reads this to apply the same data-schema rule before any app runs.
    await safeDirectory(this.#installRoot, true);
    await writeJsonAtomic(join(this.#installRoot, DATA_LINK), { appDataDirectory: this.#appData });
    const installed = await this.#layout.install(artifactPath, manifest);
    return Object.freeze({ applied: true, version: installed.version, previous: installed.previous, state: 'trial', restartRequired: true, backupVerified: backup.backup !== null, fromSchema, toSchema: manifest.dataSchemaVersion });
  }
  async rollback(input:{ confirmed:boolean }):Promise<ServiceRollbackResult> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Rolling back waits for your confirmation.');
    // Both checks run inside the layout's install lock, against the pointer it is about to move.
    const result = await this.#layout.rollback({ canReturnTo: async previous => {
      const document = await this.#guard.lastDocument();
      check(!document || !channelEntry(document, process.platform, process.arch, previous)?.withdrawn, 'ROLLBACK_TARGET_WITHDRAWN', 'The previous version was withdrawn by the publisher; install a newer release instead.');
      check(await this.#canOpenVault(previous), 'VAULT_NEWER_THAN_APP', 'The previous version cannot open this vault: a newer version already upgraded its data. Restore the backup made before the update instead.');
      return true;
    } });
    return Object.freeze({ rolledBack: true, from: result.from, to: result.to, restartRequired: true });
  }
  /** Called by the newly launched version once it is healthy; commits its trial. */
  confirmHealthy():Promise<InstallPointer> { return this.#layout.confirmHealthy(this.#version); }
  /**
   * Launcher entry. Safe rule for automatic rollback: never return to a version that cannot open the vault. If the
   * trial version already migrated the data (the marker is above the previous version's recorded schema), the trial
   * stays current and reports `rollbackUnavailable` rather than stranding the vault behind VAULT_NEWER_THAN_APP;
   * the backup made before the swap is the way back.
   */
  resolveLaunch():Promise<LaunchDecision|null> {
    // Evaluated inside the install lock, so a concurrent swap cannot slip between the check and the move.
    return this.#layout.resolveLaunch({ canReturnTo: version => this.#canOpenVault(version) });
  }
  #canOpenVault(version:string):Promise<boolean> { return versionCanOpenVault(this.#data, this.#ledger, version); }
  async #refuseWithdrawn(manifest:ReleaseManifest, code:string):Promise<void> {
    const document = await this.#guard.lastDocument(), entry = document && channelEntry(document, manifest.platform, manifest.architecture, manifest.version);
    if (!entry) return;
    check(!entry.withdrawn, code, 'The publisher withdrew this release; it will not be installed.');
    check(createHash('sha256').update(canonicalReleaseManifest(manifest)).digest('hex') === entry.manifestSha256, 'UPDATE_MANIFEST_MISMATCH', 'The staged release differs from the one named by the signed feed.');
  }
  async #pending():Promise<{ manifest:ReleaseManifest; artifactPath:string }> {
    const directory = await safeDirectory(this.#stageDirectory, true), record:any = await readJsonFile(join(directory, 'pending-release.json'), 256 * 1024, 'UPDATE_NOT_STAGED');
    check(record && typeof record === 'object' && typeof record.artifactPath === 'string' && typeof record.signature === 'string', 'UPDATE_NOT_STAGED', 'Download and verify an update before installing it.');
    const manifest = this.#updater.verify(record.manifest, record.signature);
    check(isAbsolute(record.artifactPath) && dirname(record.artifactPath) === directory, 'UNSAFE_UPDATE_PATH', 'The staged artifact is outside the private staging directory.');
    return { manifest, artifactPath: record.artifactPath };
  }
}
function installMode(manifest:ReleaseManifest):InstallMode {
  try { artifactKind(manifest.url); return 'in-place-swap'; }
  catch (error) { if (error instanceof ChausarError && error.code === 'NATIVE_INSTALLER_REQUIRED') return 'manual-native-installer-required'; throw error; }
}
