import { isId, requirePhone } from './contracts.ts';
import type { PhoneChannel } from './contracts.ts';

export type MessagingChannel = Extract<PhoneChannel, 'whatsapp' | 'email'>;
export type NotificationEvent = 'brief-ready' | 'approval-needed' | 'document-received' | 'due-date-reminder';
export type CompanionDestination = 'briefs' | 'approvals' | 'uploads' | 'calendar';
export type MessagingOptIn = { channel: MessagingChannel; optedIn: boolean; recordedAt: string };
export type MessagingNotification = { channel: MessagingChannel; event: NotificationEvent; text: string; destination: CompanionDestination };
const events: Record<NotificationEvent, { text: string; destination: CompanionDestination }> = {
  'brief-ready': { text: 'Your Chausar brief is ready. Open the app to read it.', destination: 'briefs' },
  'approval-needed': { text: 'Chausar needs your decision. Open the app to review it.', destination: 'approvals' },
  'document-received': { text: 'Chausar received your document. Open the app to confirm it.', destination: 'uploads' },
  'due-date-reminder': { text: 'Your Chausar reminder is ready. Open the app to read it.', destination: 'calendar' },
};
/** Generic text only: no names, amounts, identifiers, business data, or approval tokens. */
export function messagingNotification(optIn: MessagingOptIn, event: NotificationEvent): MessagingNotification {
  requirePhone(!!optIn && ['whatsapp', 'email'].includes(optIn.channel) && optIn.optedIn === true && Number.isFinite(Date.parse(optIn.recordedAt)) && Object.hasOwn(events, event), 'CHANNEL_FORBIDDEN');
  return { channel: optIn.channel, event, ...events[event] };
}
/** Links open a paired responsive page; a link itself grants no authority. */
export function companionLink(origin: string, destination: CompanionDestination): string {
  requirePhone(typeof origin === 'string' && origin.length <= 2048 && ['briefs', 'approvals', 'uploads', 'calendar'].includes(destination), 'INVALID_REQUEST');
  let url: URL;
  try { url = new URL(origin); } catch { requirePhone(false, 'INVALID_REQUEST'); }
  requirePhone(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'INVALID_REQUEST');
  return `${url.origin}/companion/${destination}`;
}
export type MessagingReply = { response: 'human-help' | 'stopped' | 'open-app'; text: string; optIn: MessagingOptIn };
/** Bare YES/text is never an approval. An authenticated decision uses the same atomic protocol. */
export function messagingInbound(optIn: MessagingOptIn, text: string, now = Date.now()): MessagingReply {
  requirePhone(!!optIn && ['whatsapp', 'email'].includes(optIn.channel) && typeof text === 'string' && text.length <= 8000 && Number.isFinite(now), 'INVALID_REQUEST');
  const command = text.trim().toUpperCase();
  if (command === 'STOP') return { response: 'stopped', text: 'Chausar messages are stopped.', optIn: { channel: optIn.channel, optedIn: false, recordedAt: new Date(now).toISOString() } };
  if (command === 'HELP') return { response: 'human-help', text: 'Open Help in Chausar to contact a person.', optIn: { ...optIn } };
  return { response: 'open-app', text: 'Open Chausar for chat or to review a decision. Send HELP for help or STOP to stop messages.', optIn: { ...optIn } };
}

/** A relay stores sealed transport bytes only. Collecting an intent never authorizes it. */
export type SealedRelayEnvelope = {
  envelopeId: string; routeId: string; format: 'chausar-companion-sealed-v1';
  purpose: 'notification' | 'upload' | 'approval-intent';
  createdAt: string; expiresAt: string; nonce: Uint8Array; ciphertext: Uint8Array;
};
export interface CompanionRelay {
  collect(routeId: string, signal: AbortSignal): Promise<SealedRelayEnvelope[]>;
  /** Acknowledgement concerns envelope delivery only, never action approval or execution. */
  acknowledge(envelopeId: string, disposition: 'collected' | 'expired' | 'invalid', signal: AbortSignal): Promise<void>;
}
export function validRelayEnvelope(envelope: SealedRelayEnvelope, now = Date.now()): boolean {
  return !!envelope && isId(envelope.envelopeId) && isId(envelope.routeId) && envelope.format === 'chausar-companion-sealed-v1' && ['notification', 'upload', 'approval-intent'].includes(envelope.purpose) && Number.isFinite(now) && Number.isFinite(Date.parse(envelope.createdAt)) && Date.parse(envelope.createdAt) <= now && Date.parse(envelope.expiresAt) > now && Date.parse(envelope.expiresAt) - Date.parse(envelope.createdAt) <= (envelope.purpose === 'approval-intent' ? 300000 : 86400000) && envelope.nonce instanceof Uint8Array && envelope.nonce.length === 12 && envelope.ciphertext instanceof Uint8Array && envelope.ciphertext.byteLength >= 16 && envelope.ciphertext.byteLength <= 10 * 1024 * 1024;
}
