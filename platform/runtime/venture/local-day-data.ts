// Browser-safe country calendar-zone mapping shared by the engine and rehearsal.
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = Object.freeze({
  IN: 'Asia/Kolkata', US: 'America/New_York', GB: 'Europe/London', CA: 'America/Toronto', AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland', SG: 'Asia/Singapore', AE: 'Asia/Dubai', DE: 'Europe/Berlin', FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam', IE: 'Europe/Dublin', ZA: 'Africa/Johannesburg', JP: 'Asia/Tokyo', XX: 'UTC',
});
