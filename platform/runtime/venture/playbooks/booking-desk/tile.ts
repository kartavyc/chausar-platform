// Booking desk tile (wave 6, package 6E3): original Chausar product data. Hours and pay are a model estimate, labelled so.
import type { StartTile } from '../kit/define.ts';
export const BOOKING_TILE: StartTile = {
  category: 'shops-and-firms', icon: 'calendar',
  line: 'Enquiries, open slots, quotes, deposits by UPI and reminders for local services.',
  youDo: { hoursMin: 10, hoursMax: 40, line: 'Do the visits, confirm bookings and send reminders.' },
  team: { roleIds: ['reader', 'writer', 'keeper', 'billing'], line: 'Reads enquiries, drafts confirmations, keeps slots and deposits.' },
  pay: { minRupees: 500, maxRupees: 25000, per: 'a booking' },
};
