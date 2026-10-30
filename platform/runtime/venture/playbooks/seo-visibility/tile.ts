// Chausar SEO gallery data. GEOHub (AGPL, ideas only), seo-agent (MIT); estimates belong to Chausar.
import type { StartTile } from '../kit/define.ts';
export const SEO_TILE: StartTile = {
    category: 'marketing', icon: 'search', line: 'Site checks and captured AI-answer checks for local businesses.',
    youDo: { hoursMin: 3, hoursMax: 5, line: 'Approve reports and fixes, talk to clients.' },
    team: { roleIds: ['researcher', 'writer', 'checker', 'billing'], line: 'Checks sites, drafts reports, keeps the evidence.' },
    pay: { minRupees: 10000, maxRupees: 35000, per: 'a client a month' },
};
