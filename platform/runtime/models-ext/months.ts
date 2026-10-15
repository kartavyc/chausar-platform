/**
 * The one calendar-month function for models-ext meters: model spend (routes) and voice minutes bucket an instant
 * by the workspace's time zone. A zone the runtime does not know falls back to India time instead of throwing.
 */
import type { State } from '../contracts.ts';

export const DEFAULT_ZONE = 'Asia/Kolkata';
const formats = new Map<string, Intl.DateTimeFormat>();
function format(zone: string): Intl.DateTimeFormat | undefined {
  let found = formats.get(zone);
  if (!found) { try { found = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' }); } catch { return undefined; } if (formats.size < 64) formats.set(zone, found); }
  return found;
}
/** The zone itself when Intl accepts it, else India time. */
export function validZone(zone: unknown): string {
  return typeof zone === 'string' && zone.length > 0 && zone.length <= 64 && format(zone) ? zone : DEFAULT_ZONE;
}
/** The workspace's time zone, validated (India when none or an unknown one is set). */
export const workspaceZone = (state: State) => validZone((state.workspace as { timeZone?: unknown } | undefined)?.timeZone);
/** Calendar month ('YYYY-MM') of an instant in a time zone (India when none or an unknown one is given). */
export function monthOf(at: Date | string | number, timeZone: string = DEFAULT_ZONE): string {
  const parts = format(validZone(timeZone))!.formatToParts(at instanceof Date ? at : new Date(at));
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
