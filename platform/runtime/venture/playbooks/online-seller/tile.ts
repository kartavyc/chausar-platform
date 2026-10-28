// Chausar seller gallery tile, from the commerce research catalogue; no source code copied.
import type { StartTile } from '../kit/define.ts';
export const SELLER_TILE: StartTile = { category: 'shops-and-firms', icon: 'store', line: 'Listing, ads and settlement audits from the seller exports you add.',
  youDo: { hoursMin: 3, hoursMax: 6, line: 'Check exports and approve every draft.' }, team: { roleIds: ['analyst', 'auditor', 'billing'], line: 'Checks margins, listings and payouts.' },
  pay: { minRupees: 5000, maxRupees: 20000, per: 'per audit or a client a month' } };
