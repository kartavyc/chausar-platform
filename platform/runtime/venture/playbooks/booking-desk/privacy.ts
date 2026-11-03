// Chausar playbook: Forget for the booking desk (wave 6, package 6E3; the founder's DPDP rule). A forgotten client's
// bookings go, with their address, phone and reminders, and the slots they held open again. Their invoices stay in Money
// under the books' own rules. Written for Chausar; nothing here is learned from an outside source.
import type { VentureTx } from '../../records.ts';
import { removeRecords } from '../../network/people.ts';

export function eraseBookings(tx: VentureTx, clientIds: ReadonlySet<string>, handles: ReadonlySet<string>, mentions: (value: unknown) => boolean): void {
  const named = (value: unknown) => { const text = JSON.stringify(value) ?? ''; return mentions(text) || [...handles].some(handle => handle.length >= 3 && text.toLowerCase().includes(handle.toLowerCase())); };
  const ids = new Set(tx.list('venture-booking').filter(row => clientIds.has(row.booking.clientId) || named(row.booking)).map(row => row.id));
  if (!ids.size) return;
  removeRecords(tx, row => row.kind === 'venture-booking' && ids.has(String(row.id)));
  tx.emit('desk.changed', { playbook: 'booking-desk' });
}
