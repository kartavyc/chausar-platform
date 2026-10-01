import type { CompanionViewState } from '../../../shared/view-contracts.ts';

export function hasOnlineAuthority(state: CompanionViewState): boolean {
  const pairing = state.client.pairing;
  return state.client.connection === 'online' && pairing.status === 'paired' &&
    'authority' in pairing && Date.parse(pairing.authority.expiresAt) > Date.now();
}

export function canWorkOnline(state: CompanionViewState): boolean {
  return hasOnlineAuthority(state) && state.busy.length === 0;
}
export function approvalCanDecide(state: CompanionViewState, now: number): boolean {
  return canWorkOnline(state) && state.approval?.eligibility === 'simple-reversible' && Number.isFinite(Date.parse(state.approval.expiresAt)) && Date.parse(state.approval.expiresAt) > now;
}

/** Other in-flight work must not block checking or cancelling this request. */
export function requestControls(state: CompanionViewState, request: CompanionViewState['client']['requests'][number]) {
  const active = ['pending', 'unknown', 'cancelling'].includes(request.status);
  const busy = state.busy.includes(`status_${request.requestId}`) || state.busy.includes(`cancel_${request.requestId}`);
  const ready = hasOnlineAuthority(state) && active && !busy;
  return { canRefresh: ready, canCancel: ready && request.status !== 'cancelling' };
}

export function readableTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? 'Time unavailable' : time.toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function authorityLabel(state: CompanionViewState): string {
  if (state.client.pairing.status === 'revoked') return 'Device access revoked. Pair again from your desktop.';
  if (state.client.pairing.status === 'expired') return 'Session expired. Pair again from your desktop.';
  if (state.client.connection === 'offline') return 'Offline · Saved briefs are read only. Approvals require a fresh connection.';
  if (state.client.connection === 'connecting') return 'Connecting · Checking device access and request status.';
  if (state.client.pairing.status === 'validation-required') return 'Connection check required · Saved access is not current authority.';
  if (state.client.pairing.status === 'pairing') return 'Pairing · Waiting for your desktop-authorized connection.';
  if (state.client.pairing.status === 'unpaired') return 'Ready to pair · Your desktop authorizes this device.';
  if (!hasOnlineAuthority(state)) return 'Session check required · Reconnect for fresh online validation.';
  return 'Connected · Every action validates device access online.';
}

export function uploadStatus(status: string): string {
  return ({ 'awaiting-confirmation': 'Confirmation needed', pending: 'Waiting for the engine',
    unknown: 'Outcome not known', cancelling: 'Cancellation requested', cancelled: 'Cancelled',
    succeeded: 'Received', failed: 'Could not complete' } as Record<string, string>)[status] ?? 'Processing';
}

export function pairingLabel(status: string): string {
  return ({ unpaired: 'Not paired', pairing: 'Pairing', paired: 'Validated online',
    'validation-required': 'Fresh validation required', revoked: 'Revoked', expired: 'Expired' } as Record<string, string>)[status] ?? 'Fresh validation required';
}

/** Controller errors become fixed notices. Never put adapter error text in the UI. */
export function run(action: () => Promise<void>): void { void action().catch(() => {}); }
