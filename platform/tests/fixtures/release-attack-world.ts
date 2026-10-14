import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseManifest, type ReleaseManifest } from '../../runtime/updater.ts';
import type { HttpRequest, HttpResponse } from '../../runtime/connectors.ts';
import { canonicalChannelDocument, type ChannelDocument, type ChannelRelease } from '../../runtime/native/update-channel.ts';
import { UpdateService } from '../../runtime/native/update-service.ts';
import { InstallLayout } from '../../runtime/native/update-install.ts';

// Synthetic keys and inert artifacts only; no request leaves the process and nothing is executed.
export const keys = generateKeyPairSync('ed25519');
export const code = (expected:string) => (error:any) => { assert.equal(error?.code, expected, `expected ${expected}, got ${error?.code}: ${error?.message}`); return true; };
export const hash = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
export const signText = (text:string, key = keys.privateKey) => sign(null, Buffer.from(text), key).toString('base64url');
export const FEED = 'https://updates.example.com/stable.json', HOUR = 3600000;
export const platform = process.platform as ReleaseManifest['platform'], architecture = process.arch as ReleaseManifest['architecture'];

export async function temporary(t:any, prefix = 'chausar-release-attack-') {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix)); t.after(() => rm(root, { recursive: true, force: true })); return root;
}
export function releaseManifest(version:string, artifact:Uint8Array, over:Partial<ReleaseManifest> = {}):ReleaseManifest {
  return { schemaVersion: 1, version, publishedAt: '2026-09-01T00:00:00.000Z', platform, architecture, url: `https://downloads.example.com/Chausar-${version}.AppImage`,
    sha256: hash(artifact), size: artifact.length, minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true }, ...over };
}
export function entry(version:string, manifestSha256:string, over:Partial<ChannelRelease> = {}):ChannelRelease {
  return { version, platform, architecture, manifestSha256, rolloutPercent: 100, withdrawn: false, previewExpiresAt: null, ...over };
}

/** A served feed, manifests and artifacts, plus an install layout where `current` was installed and committed. */
export async function world(t:any, options:{ current?:string; schema?:number; targetSchema?:number } = {}) {
  const root = await temporary(t), current = options.current ?? '1.0.0', target = '1.1.0';
  const artifact = Buffer.from('Inert Chausar 1.1.0 AppImage fixture. Never execute this file.');
  const manifest = releaseManifest(target, artifact, { dataSchemaVersion: options.targetSchema ?? 2 });
  const manifestText = canonicalReleaseManifest(manifest);
  const files:Record<string, string|Uint8Array> = {};
  const manifestUrl = (version:string) => `https://updates.example.com/releases/${version}/${platform}-${architecture}.json`;
  let issued = Date.now() - HOUR;
  /** Publishes a new signed feed with a strictly later issue time. */
  const publish = (releases:ChannelRelease[], over:Partial<ChannelDocument> = {}) => {
    issued += 60000;
    const document:ChannelDocument = { format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 24 * HOUR).toISOString(), releases, ...over };
    const text = canonicalChannelDocument(document); files[FEED] = text; files[FEED + '.sig'] = signText(text); return { text, signature: files[FEED + '.sig'] as string };
  };
  const serveManifest = (value:ReleaseManifest) => { const text = canonicalReleaseManifest(value); files[manifestUrl(value.version)] = text; files[manifestUrl(value.version) + '.sig'] = signText(text); return text; };
  serveManifest(manifest); files[manifest.url] = artifact;
  publish([entry(target, hash(manifestText))]);
  const requested:HttpRequest[] = [];
  const http = async (request:HttpRequest):Promise<HttpResponse> => { requested.push(request); const body = files[request.url]; return body === undefined ? { status: 404, url: request.url, body: '' } : { status: 200, url: request.url, body }; };
  const installRoot = join(root, 'install'), appDataDirectory = join(root, 'app-data');
  const make = (version:string, schema = options.schema ?? 1) => new UpdateService({ publicKey: keys.publicKey, version, channel: 'stable', installRoot, appDataDirectory, feedUrl: FEED, http, installId: 'install-attack-0001', demo: false, dataSchemaVersion: schema });
  const running = Buffer.from(`Inert running ${current} fixture.`), runningPath = join(root, 'running.artifact'); await writeFile(runningPath, running);
  const layout = new InstallLayout({ installRoot });
  await layout.install(runningPath, releaseManifest(current, running));
  await layout.confirmHealthy(current);
  const backupBytes = Buffer.from('{"synthetic":"vault backup"}'), backupPath = join(root, 'backup.json'); await writeFile(backupPath, backupBytes);
  return { root, make, files, requested, manifest, manifestText, artifact, publish, serveManifest, manifestUrl, backup: { path: backupPath, sha256: hash(backupBytes) }, installRoot, appDataDirectory, layout };
}
