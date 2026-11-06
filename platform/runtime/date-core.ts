// Portable calendar-day validation and addition, extracted unchanged from memory and venture money dates.
import {check} from './portable.ts';
export function validDate(value: unknown): value is string { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const d = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
/** Add a bounded whole number of days without assigning a time zone to a calendar date. */
export function addDaysUtc(iso:string,days:number):string {
 check(validDate(iso),'INVALID_VENTURE_REQUEST','Use a date like 2026-10-15.');
 check(Number.isInteger(days)&&days>=0&&days<=3660,'INVALID_VENTURE_REQUEST','Use a whole number of days.');
 const date=new Date(`${iso}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
