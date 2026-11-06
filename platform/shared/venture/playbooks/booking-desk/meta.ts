// Chausar playbook: Booking desk offers and intake questions (wave 6, package 6E3). Portable data with no
// imports, so the kit definition (definition.ts) and the fake engine's onboarding read the very same words. Written for
// Chausar; nothing here is learned from an outside source.
/** The offer and question shapes the kit's KitOffer and KitIntakeField accept (kit/define.ts), kept import-free here. */
export type MetaOffer = { id: string; name: string; description: string; pricing: 'monthly' | 'project' | 'hourly'; unit: string; price: 'owner-sets'; stages: readonly string[]; includes: readonly string[]; pilotable: boolean; rights: readonly []; intake: readonly string[]; audience: 'client' };
export type MetaField = { id: string; label: string; help: string; kind: 'people' | 'text' | 'date'; required: boolean; options?: readonly string[] };

const intake = ['service', 'address', 'preferredTime'];
export const BOOKING_OFFERS: readonly MetaOffer[] = [
  { id: 'home-visit', name: 'Home visit', description: 'A visit to the client for a service, booked into one of your slots.', pricing: 'project', unit: 'per visit', price: 'owner-sets', stages: ['draft'], includes: ['Booking confirmation'], pilotable: true, rights: [], intake, audience: 'client' },
  { id: 'appointment', name: 'Appointment', description: 'An appointment at your place in one of your slots.', pricing: 'project', unit: 'per appointment', price: 'owner-sets', stages: ['draft'], includes: ['Booking confirmation'], pilotable: false, rights: [], intake: ['service', 'preferredTime'], audience: 'client' },
  { id: 'event-package', name: 'Event package', description: 'A package for an event or a wedding, with a deposit to hold the date.', pricing: 'project', unit: 'per event', price: 'owner-sets', stages: ['draft'], includes: ['Booking confirmation', 'Event checklist'], pilotable: false, rights: [], intake: ['service', 'address', 'eventDate'], audience: 'client' },
  { id: 'monthly-plan', name: 'Monthly plan', description: 'A regular service every month, such as meals or upkeep visits.', pricing: 'monthly', unit: 'a client a month', price: 'owner-sets', stages: ['draft'], includes: ['Schedule'], pilotable: false, rights: [], intake: ['service', 'address'], audience: 'client' },
];

export const BOOKING_INTAKE_FIELDS: readonly MetaField[] = [
  { id: 'service', label: 'What the client wants', help: "The service, in the client's words.", kind: 'text', required: false },
  { id: 'address', label: 'Where', help: 'The address for a visit; leave empty for your own place.', kind: 'text', required: false },
  { id: 'preferredTime', label: 'Preferred time', help: 'When the client would like it; the desk holds the real slot.', kind: 'text', required: false },
  { id: 'eventDate', label: 'Event date', help: 'The day of the event or wedding.', kind: 'date', required: false },
];

/** The registry entry's data (registration.ts types it as a PlaybookRegistration). */
export const BOOKING_REGISTRATION_DATA = Object.freeze({
  id: 'booking-desk',
  label: 'Booking desk for local services',
  serviceType: 'local-services' as const,
  picks: ['booking desk', 'take bookings', 'appointment bookings', 'home salon', 'beauty salon', 'electrician visits', 'plumber visits', 'ac service visits', 'tiffin service', 'home chef', 'wedding planner', 'event planner', 'physiotherapy visits'],
  summary: 'Agents read enquiries and draft confirmations; Chausar keeps your slots, quotes from your prices, deposits through your UPI link and reminders you send yourself.',
  riskLevel: 'medium' as const,
  lastReviewed: '2026-11-01',
});
