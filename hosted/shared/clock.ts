export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
export const iso = (clock: Clock) => clock().toISOString();
export const later = (clock: Clock, ms: number) => new Date(clock().getTime() + ms).toISOString();
/** Calendar month in India Standard Time, the unit of the monthly message budget. */
export function monthKey(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}
