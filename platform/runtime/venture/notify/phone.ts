// Wave 6 package 6F7 (D35): phone access. The owner opens Chausar on their own phone, on the same Wi-Fi by a one-time
// pairing link, or away from home through Tailscale. venture.phone.access (app only) reads the state, makes a pairing
// link (the host starts its phone listener when needed) or stops phone access, which ends every phone session. The
// listener itself belongs to the host (platform/runtime/phone-access.ts through VentureDeps.phoneAccess): a phone gets
// the channel 'phone', so everything the app keeps to itself (app-only methods, such as AI connect, compose decide and
// fill, billing and these settings) stays refused there, exactly as before. The hosted app has its own address.
import { authorize, check, type Context } from '../../contracts.ts';
import { exactPayload, requireAppChannel, requireVenture } from '../records.ts';
import type { PhoneAccessPort, PhoneAccessView, VentureDeps } from '../contracts.ts';
import { qrMatrix } from '../money/qr.ts';

export const PHONE_LINK_MINUTES = 10;
export const DEFAULT_PHONE_HOURS = 12;
const WORDS = Object.freeze({
  hosted: 'The hosted app opens on a phone by its own address. Phone access is for the desktop app.',
  unavailable: 'Phone access works in the Chausar app on this computer.',
  noWifi: 'This computer is not on a home network Chausar can use. Join your Wi-Fi and try again.',
  noTailscale: 'Tailscale is not running on this computer. The phone access guide shows how to set it up.',
  hours: 'Choose how long a phone stays paired, from 1 to 24 hours.',
  off: 'Phone access is off. Make a pairing link to open Chausar on your phone.',
  link: `Open this link on your phone within ${PHONE_LINK_MINUTES} minutes. It works once.`,
});

function viewOf(port: PhoneAccessPort, link: { link: string; expiresAt: string } | null = null): PhoneAccessView {
  const status = port.status();
  const line = link ? WORDS.link
    : !status.on ? WORDS.off
      : `Phone access is on. ${status.phones} ${status.phones === 1 ? 'phone is' : 'phones are'} paired. Some approvals still need this computer.`;
  return { on: status.on, addresses: status.addresses.map(item => ({ ...item })), phones: status.phones, link: link?.link ?? null, expiresAt: link?.expiresAt ?? null, line, qr: link ? (({ size, rows }) => ({ size, rows }))(qrMatrix(link.link)) : null };
}

/**
 * venture.phone.access { action?: 'link' | 'stop', via?: 'wifi' | 'tailscale', hours?: 1 to 24 } (approve, app only).
 * Empty reads the state; 'link' makes a one-time pairing link that works for 10 minutes, for a phone session of `hours`
 * (12 unless the owner chooses); 'stop' closes the listener and ends every phone session. Not on the hosted app.
 */
export async function phoneAccessHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PhoneAccessView> {
  requireAppChannel(ctx, 'venture.phone.access');
  const body = exactPayload(payload, ['action', 'via', 'hours']);
  check(deps.host !== 'hosted-web', 'TIER_UNAVAILABLE', WORDS.hosted);
  authorize(deps.store, ctx, 'approve');
  requireVenture(deps.store.read());
  const port = deps.phoneAccess;
  check(port, 'PHONE_ACCESS_UNAVAILABLE', WORDS.unavailable);
  check(body.action === undefined || body.action === 'link' || body.action === 'stop', 'INVALID_VENTURE_REQUEST', 'Send action as link or stop.');
  check(body.action === 'link' || (body.via === undefined && body.hours === undefined), 'INVALID_VENTURE_REQUEST', 'Only a pairing link takes via and hours.');
  if (body.action === 'stop') { await port.stop(); return viewOf(port); }
  if (body.action !== 'link') return viewOf(port);
  const via = body.via ?? 'wifi';
  check(via === 'wifi' || via === 'tailscale', 'INVALID_VENTURE_REQUEST', 'Send via as wifi or tailscale.');
  const hours = body.hours ?? DEFAULT_PHONE_HOURS;
  check(Number.isInteger(hours) && (hours as number) >= 1 && (hours as number) <= 24, 'INVALID_VENTURE_REQUEST', WORDS.hours);
  check(port.status().addresses.some(item => item.via === via), 'PHONE_NO_NETWORK', via === 'wifi' ? WORDS.noWifi : WORDS.noTailscale);
  const made = await port.link({ via, hours: hours as number, minutes: PHONE_LINK_MINUTES });
  return viewOf(port, made);
}
