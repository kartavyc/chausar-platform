// Chausar venture launcher, policy (Ink v2 wave 1, H9): rolling out the untrusted screen, as engine methods.
// venture.untrusted.mode sets the business's screen mode: observe by default, enforce once the owner turns it on.
// venture.untrusted.release lets one held content through, bound to its digest, so changed content is held again.
// Both are the owner's, inside the app. screenSettingOf is what a run reads (delivery/harness/env.ts).
import { check, type Context, type State } from '../../contracts.ts';
import type { ScreenSettingRecord, UntrustedReleaseRecord, VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { SCREEN_MODES, type ScreenMode, type ScreenSetting } from './untrusted.ts';

const DIGEST = /^[0-9a-f]{64}$/;

/** The business's screen as a run reads it: the newest mode, observe until one is set, and every released digest. */
export function screenSettingOf(state: State, ventureId: string): ScreenSetting {
  const settings = listRecords(state, 'venture-screen-setting', ventureId);
  const mode: ScreenMode = settings.length ? settings[settings.length - 1].mode : 'observe';
  const released = [...new Set(listRecords(state, 'venture-untrusted-release', ventureId).map(record => record.digest))];
  return { mode, released };
}

function ownerOnly(ctx: Context): void {
  check(ctx.role === 'owner' || ctx.role === 'cofounder', 'APP_APPROVAL_REQUIRED', 'Only you change the screen, inside the Chausar app.');
}

/** venture.untrusted.mode { mode }: observe notes what the screen finds; enforce cleans outside content and holds what is aimed at the agent. */
export async function untrustedModeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ mode: ScreenMode }> {
  requireAppChannel(ctx, 'venture.untrusted.mode');
  ownerOnly(ctx);
  const body = exactPayload(payload, ['mode'], ['mode']);
  check(typeof body.mode === 'string' && (SCREEN_MODES as readonly string[]).includes(body.mode), 'INVALID_VENTURE_REQUEST', 'Choose observe or enforce.');
  const mode = body.mode as ScreenMode;
  await ventureAction(deps, ctx, 'approve', 'untrusted.mode', tx => { tx.put<ScreenSettingRecord>({ ...tx.base('venture-screen-setting'), mode }); });
  return { mode };
}

/**
 * venture.untrusted.release { digest }: the owner looked at held content and lets that exact content through. It stays
 * untrusted: the taint latch still holds what a run does after reading it.
 */
export async function untrustedReleaseHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ digest: string; released: true }> {
  requireAppChannel(ctx, 'venture.untrusted.release');
  ownerOnly(ctx);
  const body = exactPayload(payload, ['digest'], ['digest']);
  check(typeof body.digest === 'string' && DIGEST.test(body.digest), 'INVALID_VENTURE_REQUEST', 'That is not the digest of held content.');
  const digest = body.digest;
  await ventureAction(deps, ctx, 'approve', 'untrusted.release', tx => { tx.put<UntrustedReleaseRecord>({ ...tx.base('venture-untrusted-release'), digest }); });
  return { digest, released: true };
}
