import type { BookingBody, BookingStatus, BookingMessage, BookingSlotBody } from '../../../../contract/venture/playbooks/booking-desk/records.ts';
export type { BookingBody, BookingStatus, BookingMessage, BookingSlotBody } from '../../../../contract/venture/playbooks/booking-desk/records.ts';
// Chausar playbook: Booking desk (wave 6, package 6E3). The bodies of its two record kinds, as contracts.ts types them:
// venture-booking-slot (a time the owner is open) and venture-booking (one client's booking from enquiry to done). The
// quote is the linked order's own price receipt and the deposit is an advance invoice on that order (money/), so neither
// holds an amount here. Types only. Written for Chausar; nothing here is learned from an outside source.
import type { OwnerChannel } from '../kit/owner-message.ts';



/** A time the owner is open: start in the owner's own clock as YYYY-MM-DDTHH:MM, and its length. */


/** A reminder waiting for the owner's exact approval and their own send. */




export type BookingSlotRecordBody = { slot: BookingSlotBody };
export type BookingRecordBody = { booking: BookingBody };
