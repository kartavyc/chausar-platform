// Original Chausar tile, after cfo and finance-skills service ideas (MIT).
import type { StartTile } from '../kit/define.ts';
export const BOOKKEEPING_TILE: StartTile = {
  category: 'money-and-tax', icon: 'calculator', line: 'Collections drafts, cash packs and spending checks for small firms.',
  youDo: { hoursMin: 3, hoursMax: 6, line: 'Review the books, approve reports and talk to clients.' },
  team: { roleIds: ['analyst', 'checker', 'billing'], line: 'Reads ledgers, calculates figures and prepares reports.' },
  pay: { minRupees: 5000, maxRupees: 20000, per: 'a client a month' },
};
