// Canonical browser-safe types, shared by the engine and renderer.
import type { OwnerChannel } from '../../../../shared/venture/playbooks/kit/owner-message.ts';

export type BookingBody = {
  clientId: string;
  request: string;
  address: string;
  phone: string | null;
  orderId: string | null;
  slotId: string | null;
  depositInvoiceId: string | null;
  status: BookingStatus;
  messages: BookingMessage[];
  seq: number;
};

export type BookingStatus = 'enquiry' | 'quoted' | 'held' | 'confirmed' | 'done' | 'cancelled';

export type BookingMessage = {
  id: string;
  kind: 'appointment' | 'deposit';
  channel: OwnerChannel;
  to: string | null;
  subject: string | null;
  text: string;
  digest: string;
  handedOffAt: string | null;
  journalId: string | null;
};

export type BookingSlotBody = { start: string; minutes: number; note: string; closed: boolean };
