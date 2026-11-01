// Chausar playbook: Booking desk (wave 6, package 6E3). The registry entry, from its own data only. The local services
// family uses it (6E6's profession map points local services here). The data lives in meta.ts, so the browser reads
// it without the registry. Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';
import { BOOKING_REGISTRATION_DATA } from './meta.ts';

export const BOOKING_DESK_REGISTRATION: PlaybookRegistration = BOOKING_REGISTRATION_DATA;
