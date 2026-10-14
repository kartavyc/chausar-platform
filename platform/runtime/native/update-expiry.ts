import { isAbsolute } from 'node:path';
import { check } from '../contracts.ts';
import { isoTimestamp, readJsonFile } from './update-files.ts';
import type { ChannelName } from './update-channel.ts';

const MAX_PREVIEW_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
export type BuildMetadata = Readonly<{ channel:ChannelName; previewExpiresAt:string|null }>;
export type BuildUsability = Readonly<{
  channel:ChannelName; expiresAt:string|null; usable:boolean;
  /** True once a preview build is past its expiry: the app shows the "update needed" banner. */
  updateNeeded:boolean; msRemaining:number|null;
}>;
export type BuildExpiry = Readonly<{
  channel:ChannelName; builtAt:string|null; previewExpiresAt:string|null;
  status(now?:number):BuildUsability;
  /** Throws PREVIEW_EXPIRED at or after the preview expiry (no grace period). Stable builds never expire. */
  assertBuildUsable(now?:number):void;
}>;

export function buildExpiry(input:{ channel:ChannelName; builtAt?:string|null; previewExpiresAt?:string|null }):BuildExpiry {
  check(input && (input.channel === 'stable' || input.channel === 'preview'), 'BUILD_METADATA_INVALID', 'The build names an unknown release channel.');
  const builtAt = input.builtAt ?? null, expiresAt = input.previewExpiresAt ?? null, channel = input.channel;
  check(builtAt === null || isoTimestamp(builtAt), 'BUILD_METADATA_INVALID', 'The build time must be a canonical timestamp.');
  if (channel === 'stable') check(expiresAt === null, 'BUILD_METADATA_INVALID', 'Stable builds do not carry a preview expiry.');
  else {
    check(isoTimestamp(expiresAt), 'BUILD_METADATA_INVALID', 'Preview builds must carry a canonical expiry timestamp.');
    if (builtAt) check(Date.parse(expiresAt) > Date.parse(builtAt) && Date.parse(expiresAt) - Date.parse(builtAt) <= MAX_PREVIEW_LIFETIME_MS, 'BUILD_METADATA_INVALID', 'A preview expiry must fall within a year after the build time.');
  }
  const status = (now = Date.now()):BuildUsability => {
    if (expiresAt === null) return Object.freeze({ channel, expiresAt, usable: true, updateNeeded: false, msRemaining: null });
    const remaining = Date.parse(expiresAt) - now;
    return Object.freeze({ channel, expiresAt, usable: remaining > 0, updateNeeded: remaining <= 0, msRemaining: Math.max(0, remaining) });
  };
  return Object.freeze({ channel, builtAt, previewExpiresAt: expiresAt, status,
    assertBuildUsable(now?:number) { check(status(now).usable, 'PREVIEW_EXPIRED', 'This preview build has expired. Install the update to keep using Chausar.'); } });
}
/**
 * Reads the build's own release metadata from its package.json: `chausarReleaseChannel` ('stable' | 'preview')
 * and `chausarPreviewExpiresAt`. Both absent means a stable build with no expiry; anything else invalid refuses.
 */
export async function readBuildMetadata(packageJsonPath:string):Promise<BuildMetadata> {
  check(typeof packageJsonPath === 'string' && isAbsolute(packageJsonPath), 'BUILD_METADATA_INVALID', 'Read build metadata from an absolute package path.');
  const value:any = await readJsonFile(packageJsonPath, 1024 * 1024, 'BUILD_METADATA_INVALID');
  check(value && typeof value === 'object' && !Array.isArray(value), 'BUILD_METADATA_INVALID', 'The build package description is missing or invalid.');
  const hasChannel = Object.hasOwn(value, 'chausarReleaseChannel'), hasExpiry = Object.hasOwn(value, 'chausarPreviewExpiresAt');
  if (!hasChannel && !hasExpiry) return Object.freeze({ channel: 'stable', previewExpiresAt: null });
  check(hasChannel && ['stable','preview'].includes(value.chausarReleaseChannel), 'BUILD_METADATA_INVALID', 'The build release channel is missing or unknown.');
  const metadata = { channel: value.chausarReleaseChannel as ChannelName, previewExpiresAt: hasExpiry ? value.chausarPreviewExpiresAt : null };
  buildExpiry(metadata);
  return Object.freeze(metadata);
}
