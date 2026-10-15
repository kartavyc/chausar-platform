/**
 * SH-08 Updates, for the frame and Today, over the release lane's methods (`release.status`,
 * `release.stageUpdate`, `release.applyUpdate`), called as the same caller with their exact payloads.
 * The release lane verifies, stages and swaps; this file only says which state the person is in and
 * remembers the version an update was applied from, so the next start can say "rolled back" when the
 * launcher brought the old build back. Nothing here checks a feed or installs anything itself.
 */
import { authorize, audit, check, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { frameOf, optional, updateFrame } from './frame.ts';

/** When this engine process started: an update applied before it, from the version still running, did not take. */
const STARTED_AT = Date.now();
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const ISO = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value));

export type UpdatesState = 'not-built' | 'not-configured' | 'current' | 'ready' | 'restart' | 'rolled-back' | 'older-than-vault' | 'update-needed';
export type UpdatesReply = {
  state: UpdatesState; version: string | null; channel: 'stable' | 'preview' | null; expiresAt: string | null;
  candidate: string | null; platform: 'windows' | 'mac' | 'linux' | 'other'; canUpdate: boolean;
};

const platformOf = (host: ModuleHost) => {
  const platform = typeof host.options.platform === 'string' ? host.options.platform : process.platform;
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : 'other';
};
/** Updating is the owner's or co-founder's choice, from the desktop app, never from a tainted request. */
function canUpdate(ctx: Context, host: ModuleHost) {
  if ((ctx.channel !== undefined && ctx.channel !== 'desktop') || ctx.sourceTainted) return false;
  try { authorize(host.store, ctx, 'admin'); return true; } catch { return false; }
}

export async function updates(ctx: Context, host: ModuleHost): Promise<UpdatesReply> {
  const base: UpdatesReply = { state: 'not-built', version: null, channel: null, expiresAt: null, candidate: null, platform: platformOf(host), canUpdate: canUpdate(ctx, host) };
  const release = await optional(host, 'release.status');
  check(release !== null, 'UPDATES_STATUS_UNAVAILABLE', 'The update status could not be read.');
  if (release.absent) return base;
  const status = release.value;
  const version = typeof status?.version === 'string' && VERSION.test(status.version) ? status.version : null;
  const reply: UpdatesReply = { ...base, state: 'current', version, channel: status?.channel === 'stable' || status?.channel === 'preview' ? status.channel : null,
    expiresAt: ISO(status?.build?.expiresAt) ? status.build.expiresAt : null,
    candidate: typeof status?.candidate?.version === 'string' && VERSION.test(status.candidate.version) && status.candidate.version !== version ? status.candidate.version : null };
  const applied = frameOf(host.store.read()).update ?? null;
  const started = typeof host.options.startedAt === 'number' ? host.options.startedAt : STARTED_AT;
  if (status?.vaultCompatible === false) return { ...reply, state: 'older-than-vault' };
  if (applied && version !== null && version === applied.from && version !== applied.version)
    return { ...reply, state: Date.parse(applied.at) < started ? 'rolled-back' : 'restart' };
  if (status?.configured === false) return { ...reply, state: 'not-configured' };
  if (reply.candidate !== null) return { ...reply, state: 'ready' };
  if (status?.withdrawn === true || status?.build?.updateNeeded === true || status?.build?.usable === false) return { ...reply, state: 'update-needed' };
  return reply;
}

/** Step one, "checking": the release lane downloads the checked update and verifies it. Nothing is installed. */
export async function stage(_ctx: Context, host: ModuleHost) {
  const staged: any = await host.call('release.stageUpdate', { confirmed: true });
  check(staged?.staged === true && typeof staged.version === 'string' && VERSION.test(staged.version), 'UPDATE_REPLY_INVALID', 'The update reply did not fit.');
  return { step: staged.installMode === 'manual-native-installer-required' ? 'manual' as const : 'checked' as const, version: staged.version as string };
}

/** Steps two and three, "saving a copy" and "updating": the release lane copies the vault, then swaps. A restart finishes it. */
export async function apply(ctx: Context, host: ModuleHost) {
  const status: any = await host.call('release.status', {});
  check(typeof status?.version === 'string' && VERSION.test(status.version), 'UPDATE_REPLY_INVALID', 'The update reply did not fit.');
  const result: any = await host.call('release.applyUpdate', { confirmed: true });
  check(result?.applied === true && typeof result.version === 'string' && VERSION.test(result.version), 'UPDATE_REPLY_INVALID', 'The update reply did not fit.');
  await updateFrame(host, ctx, 'admin', (frame, state) => {
    frame.update = { version: result.version, from: status.version, at: now() };
    audit(state, 'update.applied', { memberId: ctx.memberId, version: result.version });
  });
  return { step: 'restart' as const, version: result.version as string };
}

/** "The update did not finish" has been read: forget the attempt. */
export async function dismiss(ctx: Context, host: ModuleHost) {
  await updateFrame(host, ctx, 'admin', frame => { frame.update = null; });
  return updates(ctx, host);
}
