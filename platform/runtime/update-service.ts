// C5 task 31: the engine's side of auto-update. A daily check of the signed feed (never in the first 10 minutes after
// start, never while a run is busy, and only while the owner leaves Check daily on) and a background download into the
// stage folder, both through updater.ts. Answers before the vault check, so it works with no business open. The public
// key and feed address come from the build's metadata, through what main hands the worker; with either missing the state
// is a plain not-set-up and nothing is asked. Installing happens at quit, in the desktop's own process (app/desktop/updates.cjs).
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ChausarError, check } from './contracts.ts';
import type { UpdateState, UpdatesView } from './update-service-core.ts';
import { ReleaseUpdater, RELEASE_CHANNELS, fetchDownload, followRelease, compareVersions, installIdIn, type DownloadRequest, type DownloadResponse, type ReleaseChannel, type ReleaseDownload, type ReleaseManifest } from './updater.ts';

export type { UpdateState, UpdatesView } from './update-service-core.ts';
export type FeedReader = (url: string) => Promise<{ text: string; signature: string }>;
export type UpdateServiceOptions = {
  publicKey: string | null; feedUrl: string | null; directory: string; version: string; channel: ReleaseChannel; windowsPublisher: string | null;
  isBusy: () => boolean; platform?: NodeJS.Platform; appImage?: string | null; clock?: () => number; readFeed?: FeedReader; download?: ReleaseDownload;
};
type LastResult = 'up-to-date' | 'staged' | 'failed' | 'cut';
type Kept = { daily: boolean; channel: ReleaseChannel | null; lastCheckAt: number | null; lastResult: LastResult | null; reason: string | null };

const FIRST_WAIT_MS = 10 * 60_000, DAY_MS = 24 * 60 * 60_000, CUT_RETRY_MS = 60 * 60_000;
const MAX_FEED_BYTES = 1024 * 1024, IDLE_TIMEOUT_MS = 60_000;
/** Where GitHub's release links lead, since the feed lives on the public repo's releases. The signed hash decides what is kept. */
const COULD_NOT_REACH = "Chausar couldn't reach the update feed. It tries again tomorrow.";

/** The daily rule, on its own so it reads as the plan says it. A cut download goes on within the hour. */
export function updateCheckDue(input: { now: number; startedAt: number; lastCheckAt: number | null; lastResult: string | null; daily: boolean; busy: boolean }): boolean {
  if (!input.daily || input.busy || input.now - input.startedAt < FIRST_WAIT_MS) return false;
  if (input.lastCheckAt === null) return true;
  return input.now - input.lastCheckAt >= (input.lastResult === 'cut' ? CUT_RETRY_MS : DAY_MS);
}

/** What main hands the worker, as the engine's options. No folder: this host has no update service. */
export function updatesOptionsFrom(environment: NodeJS.ProcessEnv): Pick<UpdateServiceOptions, 'directory' | 'publicKey' | 'feedUrl' | 'channel' | 'windowsPublisher' | 'appImage'> | undefined {
  const directory = environment.CHAUSAR_UPDATES_DIRECTORY;
  if (!directory) return undefined;
  return { directory, publicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY || null, feedUrl: environment.CHAUSAR_UPDATE_FEED || null, channel: environment.CHAUSAR_UPDATE_CHANNEL === 'beta' ? 'beta' : 'stable', windowsPublisher: environment.CHAUSAR_WINDOWS_PUBLISHER || null, appImage: environment.APPIMAGE || null };
}

type Fetcher = typeof fetch;
async function boundedText(url: string, fetcher: Fetcher): Promise<string> {
  const response = await followRelease(url, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(IDLE_TIMEOUT_MS) }, fetcher);
  check(response.status === 200, 'UPDATE_FEED_UNAVAILABLE', COULD_NOT_REACH);
  const text = await response.text();
  check(Buffer.byteLength(text) <= MAX_FEED_BYTES, 'UPDATE_FEED_TOO_BIG', 'The update feed is larger than Chausar accepts.');
  return text;
}
/** The feed and its detached signature, <feed>.sig, as release-feed.mjs writes them. */
export async function readFeedFrom(url: string, fetcher: Fetcher = fetch): Promise<{ text: string; signature: string }> {
  const text = await boundedText(url, fetcher);
  return { text, signature: (await boundedText(`${url}.sig`, fetcher)).trim() };
}
/** The app's download, updater.ts's own: a redirect is followed only to the release hosts. */
export const followingDownload = fetchDownload;

export class UpdateService {
  readonly #o: UpdateServiceOptions;
  readonly #startedAt: number;
  readonly #clock: () => number;
  #kept: Kept | null = null;
  #work: Promise<void> | null = null;
  #phase: 'checking' | 'downloading' | null = null;
  #target: ReleaseManifest | null = null;
  constructor(options: UpdateServiceOptions) {
    this.#o = options;
    this.#clock = options.clock ?? Date.now;
    this.#startedAt = this.#clock();
  }
  get configured(): boolean { return !!this.#o.publicKey && !!this.#o.feedUrl; }
  get #stage(): string { return join(this.#o.directory, 'stage'); }
  get #settingsPath(): string { return join(this.#o.directory, 'settings.json'); }

  async #load(): Promise<Kept> {
    if (this.#kept) return this.#kept;
    const blank: Kept = { daily: true, channel: null, lastCheckAt: null, lastResult: null, reason: null };
    try {
      const raw = JSON.parse(await readFile(this.#settingsPath, 'utf8'));
      this.#kept = { ...blank, daily: raw.daily !== false, channel: RELEASE_CHANNELS.includes(raw.channel) ? raw.channel : null, lastCheckAt: Number.isSafeInteger(raw.lastCheckAt) ? raw.lastCheckAt : null, lastResult: typeof raw.lastResult === 'string' ? raw.lastResult : null, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : null };
    } catch { this.#kept = blank; }
    return this.#kept;
  }
  async #save(change: Partial<Kept>): Promise<void> {
    const next = { ...(await this.#load()), ...change };
    this.#kept = next;
    await mkdir(this.#o.directory, { recursive: true });
    const temporary = `${this.#settingsPath}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, this.#settingsPath);
  }
  /** The release waiting to install, or null. One the running version has reached has done its work, and goes. */
  async #pending(): Promise<ReleaseManifest | null> {
    const path = join(this.#stage, 'pending-release.json');
    let record: { manifest?: ReleaseManifest; artifactPath?: string };
    try { record = JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
    const manifest = record.manifest;
    if (!manifest || typeof manifest.version !== 'string') return null;
    if (compareVersions(manifest.version, this.#o.version) > 0) return manifest;
    await unlink(path).catch(() => {});
    if (typeof record.artifactPath === 'string' && record.artifactPath.startsWith(this.#stage)) await unlink(record.artifactPath).catch(() => {});
    return null;
  }
  async #lastInstall(version: string): Promise<string | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.#o.directory, 'last-install.json'), 'utf8'));
      return raw.version === version && typeof raw.state === 'string' ? raw.state : null;
    } catch { return null; }
  }
  async #partBytes(manifest: ReleaseManifest | null): Promise<number | null> {
    if (!manifest) return null;
    const path = join(this.#stage, `release-${manifest.version}-${manifest.sha256.slice(0, 16)}.artifact.part`);
    return stat(path).then(info => info.size, () => null);
  }
  /** What a release waiting to install means on this computer: main's own finding at the last quit counts first. */
  async #stagedState(manifest: ReleaseManifest): Promise<UpdateState> {
    const found = await this.#lastInstall(manifest.version);
    if (found === 'needs-signing' || found === 'publisher-mismatch' || found === 'data-newer' || found === 'manual') return found;
    const platform = this.#o.platform ?? process.platform;
    if (platform === 'win32') return this.#o.windowsPublisher ? 'ready' : 'needs-signing';
    if (platform === 'linux' && this.#o.appImage) return 'ready';
    return 'manual';
  }
  /** D12 task 9: what desktop main kept in <updates>/rollbacks.json. A file a newer Chausar wrote is left alone. */
  async #rollbacks(): Promise<{ raw: any; skip: string[] } | null> {
    try {
      const raw = JSON.parse(await readFile(join(this.#o.directory, 'rollbacks.json'), 'utf8'));
      if (raw?.format !== 'chausar.rollbacks.v1' || !Array.isArray(raw.swaps) || !Array.isArray(raw.skip)) return null;
      return { raw, skip: raw.skip.filter((version: unknown) => typeof version === 'string') };
    } catch { return null; }
  }
  /** The swap the owner has not heard about; told once, and the file says so. */
  async #rolledBackLine(): Promise<UpdatesView['rolledBack'] | undefined> {
    const kept = await this.#rollbacks();
    const swap = kept?.raw.swaps.find((item: any) => item?.told === false && item.to === this.#o.version);
    if (!kept || !swap) return undefined;
    swap.told = true;
    const temporary = join(this.#o.directory, `rollbacks.${randomBytes(6).toString('hex')}.tmp`);
    await writeFile(temporary, JSON.stringify(kept.raw), { mode: 0o600 }).then(() => rename(temporary, join(this.#o.directory, 'rollbacks.json'))).catch(() => unlink(temporary).catch(() => {}));
    return { from: String(swap.from), to: String(swap.to), at: String(swap.at), reason: swap.reason === 'failed-migration' ? 'failed-migration' : 'failed-start' };
  }
  async view(): Promise<UpdatesView> {
    const rolledBack = await this.#rolledBackLine();
    const view = await this.#plainView();
    return rolledBack ? { ...view, rolledBack } : view;
  }
  async #plainView(): Promise<UpdatesView> {
    const kept = await this.#load();
    const base = { configured: this.configured, version: this.#o.version, installMode: 'manual-native-installer-required' as const, channel: kept.channel ?? this.#o.channel, daily: kept.daily, lastCheckedAt: kept.lastCheckAt === null ? null : new Date(kept.lastCheckAt).toISOString() };
    if (!this.configured) return { ...base, state: 'not-set-up', target: null, downloadedBytes: null, reason: null };
    const targetOf = (manifest: ReleaseManifest) => ({ version: manifest.version, bytes: manifest.size });
    if (this.#phase === 'checking') return { ...base, state: 'checking', target: null, downloadedBytes: null, reason: null };
    if (this.#phase === 'downloading' && this.#target) return { ...base, state: 'downloading', target: targetOf(this.#target), downloadedBytes: await this.#partBytes(this.#target) ?? 0, reason: null };
    // A release already waiting still installs at quit, whatever today's check found.
    const pending = await this.#pending();
    if (pending) return { ...base, state: await this.#stagedState(pending), target: targetOf(pending), downloadedBytes: null, reason: null };
    if (kept.lastResult === 'failed' || kept.lastResult === 'cut') return { ...base, state: 'failed', target: this.#target ? targetOf(this.#target) : null, downloadedBytes: await this.#partBytes(this.#target), reason: kept.reason };
    return { ...base, state: kept.lastResult === 'up-to-date' ? 'up-to-date' : 'idle', target: null, downloadedBytes: null, reason: null };
  }
  async settings(payload: unknown): Promise<UpdatesView> {
    const body = payload as Record<string, unknown> | null;
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
    check(keys.length > 0 && keys.every(key => (key === 'daily' && typeof body![key] === 'boolean') || (key === 'channel' && RELEASE_CHANNELS.includes(body![key] as ReleaseChannel))), 'INVALID_UPDATE_SETTINGS', 'Change Check daily or the channel.');
    await this.#save({ ...(keys.includes('daily') ? { daily: body!.daily as boolean } : {}), ...(keys.includes('channel') ? { channel: body!.channel as ReleaseChannel } : {}) });
    return this.view();
  }
  /** Check now: at once, in the background; the answer says it's working. One check at a time. */
  async checkNow(): Promise<UpdatesView> {
    if (this.configured && !this.#work) this.#begin();
    return this.view();
  }
  /** From the engine's tick: starts the day's check when it is due. Never waits for it. */
  async tick(): Promise<void> {
    if (!this.configured || this.#work) return;
    const kept = await this.#load();
    if (updateCheckDue({ now: this.#clock(), startedAt: this.#startedAt, lastCheckAt: kept.lastCheckAt, lastResult: kept.lastResult, daily: kept.daily, busy: this.#o.isBusy() })) this.#begin();
  }
  /** Tests and shutdown: the work under way has ended. */
  async settled(): Promise<void> { await this.#work; }
  #begin(): void {
    this.#phase = 'checking';
    this.#work = this.#check().finally(() => { this.#phase = null; this.#work = null; });
  }
  async #check(): Promise<void> {
    const finish = (lastResult: LastResult, reason: string | null) => this.#save({ lastCheckAt: this.#clock(), lastResult, reason }).catch(() => {});
    try {
      const kept = await this.#load(), channel = kept.channel ?? this.#o.channel;
      const url = this.#o.feedUrl!.replaceAll('{channel}', channel);
      const feed = await (this.#o.readFeed ?? readFeedFrom)(url);
      await mkdir(this.#o.directory, { recursive: true });
      const updater = new ReleaseUpdater({ publicKey: this.#o.publicKey!, version: this.#o.version, stageDirectory: this.#stage, download: this.#o.download ?? followingDownload });
      const choice = updater.verifyFeed(feed.text, feed.signature, { channel, installId: await installIdIn(this.#o.directory), now: new Date(this.#clock()), skip: (await this.#rollbacks())?.skip ?? [] });
      if (!choice.offer) { await finish('up-to-date', null); return; }
      this.#target = choice.offer.manifest;
      this.#phase = 'downloading';
      await updater.stage(choice.offer.manifest, choice.offer.signature);
      await finish('staged', null);
    } catch (error) {
      // Only Chausar's own refusals keep their words; anything else never shows what it said.
      const own = error instanceof ChausarError;
      await finish((error as { code?: unknown })?.code === 'RELEASE_DOWNLOAD_CUT' ? 'cut' : 'failed', own ? (error as Error).message : COULD_NOT_REACH);
    }
  }
}
